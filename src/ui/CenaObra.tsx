// Visualizacao 3D do avanco da obra por conjunto (three.js, sob demanda). A lista de materiais nao tem coordenadas, entao a
// estrutura e ESQUEMATICA: pilares, vigas, tercas, trelicas e contraventamentos sao dispostos como um galpao generico e cada
// peca recebe a cor do seu estado real (nao liberado, liberado, em fabricacao, fabricado, expedido, montado) e o tamanho
// proporcional ao peso. Serve para ver o avanco de um relance, nao para localizar a peca no projeto.
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ConjuntoCalc } from '../core/materiais';
import { reduzMovimento } from './numero';

export const CORES_SITUACAO: Record<ConjuntoCalc['situacao'], { css: string; padrao: string; opacidade: number }> = {
  'Não liberado': { css: '--border-strong', padrao: '#363d48', opacidade: 0.35 },
  'Liberado': { css: '--muted', padrao: '#858d9a', opacidade: 0.55 },
  'Em fabricação': { css: '--warn', padrao: '#e0a53a', opacidade: 0.9 },
  'Fabricado': { css: '--info', padrao: '#8fb0f2', opacidade: 0.9 },
  'Expedido': { css: '--brand-hover', padrao: '#e35a2c', opacidade: 0.75 },
  'Montado': { css: '--brand', padrao: '#d1481c', opacidade: 1 },
};

interface Peca { conjunto: ConjuntoCalc; pos: THREE.Vector3; tam: THREE.Vector3; rot?: THREE.Euler }
/** Layout esquematico: pilares em duas fileiras, vigas como porticos, tercas ao longo, trelicas no lugar das vigas, contraventamentos em X, o resto no chao. */
function layout(conjuntos: ConjuntoCalc[]): Peca[] {
  const por = (t: string) => conjuntos.filter((c) => c.tipo === t);
  const pilares = por('Pilar'); const vigas = [...por('Viga'), ...por('Treliça')]; const tercas = por('Terça'); const contr = por('Contraventamento');
  const outros = conjuntos.filter((c) => !['Pilar', 'Viga', 'Treliça', 'Terça', 'Contraventamento'].includes(c.tipo));
  const nPort = Math.max(2, Math.ceil(Math.max(pilares.length / 2, vigas.length / 2, 2))); const vao = 12; const alt = 4.2; const passo = 4; const z0 = -((nPort - 1) * passo) / 2;
  const escala = (c: ConjuntoCalc, base: number) => base * Math.min(1.8, Math.max(0.5, Math.sqrt(Math.max(1, c.pesoTotal) / 800)));
  const pecas: Peca[] = [];
  pilares.forEach((c, i) => { const p = Math.floor(i / 2) % nPort; const lado = i % 2 === 0 ? -1 : 1; const g = escala(c, 0.35); pecas.push({ conjunto: c, pos: new THREE.Vector3((lado * vao) / 2, alt / 2, z0 + p * passo), tam: new THREE.Vector3(g, alt, g) }); });
  vigas.forEach((c, i) => { const p = Math.floor(i / 2) % nPort; const lado = i % 2 === 0 ? -1 : 1; const g = escala(c, 0.28); const comp = Math.hypot(vao / 2, 1.9); pecas.push({ conjunto: c, pos: new THREE.Vector3((lado * vao) / 4, alt + 0.95, z0 + p * passo), tam: new THREE.Vector3(comp, g, g), rot: new THREE.Euler(0, 0, lado * -Math.atan2(1.9, vao / 2)) }); });
  tercas.forEach((c, i) => { const k = i % 9; const p = Math.floor(i / 9) % Math.max(1, nPort - 1); const fx = k / 8; const xx = -vao / 2 + fx * vao; const yy = alt + 1.9 - Math.abs(fx - 0.5) * 2 * 1.9 + 0.15; const g = escala(c, 0.16); pecas.push({ conjunto: c, pos: new THREE.Vector3(xx, yy, z0 + p * passo + passo / 2), tam: new THREE.Vector3(g, g, passo) }); });
  contr.forEach((c, i) => { const p = i % Math.max(1, nPort - 1); const lado = Math.floor(i / Math.max(1, nPort - 1)) % 2 === 0 ? -1 : 1; const g = escala(c, 0.1); const comp = Math.hypot(alt, passo); pecas.push({ conjunto: c, pos: new THREE.Vector3((lado * vao) / 2, alt / 2, z0 + p * passo + passo / 2), tam: new THREE.Vector3(g, comp, g), rot: new THREE.Euler(Math.atan2(passo, alt) * (i % 2 ? 1 : -1), 0, 0) }); });
  outros.forEach((c, i) => { const g = escala(c, 0.5); pecas.push({ conjunto: c, pos: new THREE.Vector3(-vao / 2 - 2.5 - (i % 3) * 1.4, g / 2, z0 - 1 + Math.floor(i / 3) * 1.4), tam: new THREE.Vector3(g, g, g) }); });
  return pecas;
}

export default function CenaObra({ conjuntos }: { conjuntos: ConjuntoCalc[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current; if (!host) return;
    const estatico = reduzMovimento();
    const css = getComputedStyle(document.documentElement); const cor = (v: string, padrao: string) => css.getPropertyValue(v).trim() || padrao;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0); host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(new THREE.Color(cor('--surface', '#14171b')), 22, 70);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
    const materiais = Object.fromEntries(Object.entries(CORES_SITUACAO).map(([k, v]) => [k, new THREE.MeshBasicMaterial({ color: new THREE.Color(cor(v.css, v.padrao)), transparent: true, opacity: v.opacidade })])) as Record<string, THREE.MeshBasicMaterial>;
    const matAresta = new THREE.LineBasicMaterial({ color: new THREE.Color(cor('--bg', '#0e1013')), transparent: true, opacity: 0.6 });
    const grupo = new THREE.Group(); const geos: THREE.BufferGeometry[] = [];
    const pecas = layout(conjuntos);
    for (const p of pecas) {
      const geo = new THREE.BoxGeometry(p.tam.x, p.tam.y, p.tam.z); geos.push(geo);
      const mesh = new THREE.Mesh(geo, materiais[p.conjunto.situacao]); mesh.position.copy(p.pos); if (p.rot) mesh.rotation.copy(p.rot);
      const arestas = new THREE.EdgesGeometry(geo); geos.push(arestas); const linhas = new THREE.LineSegments(arestas, matAresta); mesh.add(linhas);
      grupo.add(mesh);
    }
    const grade = new THREE.GridHelper(60, 30, new THREE.Color(cor('--border-strong', '#363d48')), new THREE.Color(cor('--border', '#262b33'))); (grade.material as THREE.Material).transparent = true; (grade.material as THREE.Material).opacity = 0.4;
    scene.add(grupo, grade);
    let alvoX = 0, mx = 0;
    const onMove = (e: PointerEvent) => { const r = host.getBoundingClientRect(); if (r.width) alvoX = (e.clientX - r.left) / r.width - 0.5; };
    host.addEventListener('pointermove', onMove, { passive: true });
    const resize = () => { const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(host); resize();
    let raf = 0; let rodando = false; const t0 = performance.now();
    const quadro = () => {
      const t = (performance.now() - t0) / 1000; mx += (alvoX - mx) * 0.06;
      const ang = 0.7 + (estatico ? 0 : t * 0.08) + mx * 0.8;
      camera.position.set(Math.sin(ang) * 26, 11, Math.cos(ang) * 26); camera.lookAt(0, 2.2, 0); renderer.render(scene, camera);
      if (!estatico && rodando) raf = requestAnimationFrame(quadro);
    };
    const iniciar = () => { if (rodando) return; rodando = true; raf = requestAnimationFrame(quadro); };
    const parar = () => { rodando = false; cancelAnimationFrame(raf); };
    const onVis = () => { if (document.visibilityState === 'visible') iniciar(); else parar(); };
    document.addEventListener('visibilitychange', onVis);
    if (estatico) { quadro(); } else iniciar();
    return () => { parar(); ro.disconnect(); host.removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis); geos.forEach((g) => g.dispose()); Object.values(materiais).forEach((m) => m.dispose()); matAresta.dispose(); grade.geometry.dispose(); (grade.material as THREE.Material).dispose(); renderer.dispose(); if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement); };
  }, [conjuntos]);
  return <div ref={ref} className="cena3d cena-obra" aria-hidden="true" />;
}
