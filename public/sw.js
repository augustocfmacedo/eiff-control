// Service worker do EIFF Control: casca do aplicativo disponivel sem rede (modo campo offline).
// - assets com hash (/assets/*): cache-first (imutaveis);
// - navegacao e index.html/manifest/icone: network-first com fallback ao cache;
// - fontes do Google: stale-while-revalidate;
// - Supabase, Netlify functions e qualquer POST: nunca interceptados (dados sempre pela rede; a fila offline e do app).
const VERSAO = 'eiff-control-sw-v1';
const CASCA = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).catch(() => undefined).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mesmaOrigem = url.origin === self.location.origin;
  if (mesmaOrigem && url.pathname.startsWith('/api/')) return; // funcoes Netlify: rede
  if (!mesmaOrigem && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return; // Supabase e o resto: rede
  if (mesmaOrigem && url.pathname.startsWith('/assets/')) { e.respondWith(cacheFirst(req)); return; }
  if (!mesmaOrigem) { e.respondWith(staleWhileRevalidate(req)); return; }
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, '/index.html')); return; }
  e.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const c = await caches.open(VERSAO); const hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req); if (r && r.ok) c.put(req, r.clone()); return r;
}
async function networkFirst(req, fallback) {
  const c = await caches.open(VERSAO);
  try { const r = await fetch(req); if (r && r.ok) c.put(req, r.clone()); return r; }
  catch { return (await c.match(req)) || (fallback && (await c.match(fallback))) || Response.error(); }
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(VERSAO); const hit = await c.match(req);
  const rede = fetch(req).then((r) => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || rede;
}
