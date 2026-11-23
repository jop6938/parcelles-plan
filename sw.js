/* Service worker : fonctionnement hors-ligne.
   - l'application elle-même : cache d'abord, mise à jour en arrière-plan
   - bibliothèque Leaflet : cache d'abord
   - cadastre : réseau d'abord (6 s si une copie existe), sinon copie mémorisée
   - tuiles IGN / OSM : cache d'abord, ajout au fil de la navigation */
const V = 'app-v1', LIBS = 'libs-v1', DATA = 'cadastre-v1', TILES = 'tuiles-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => ![V, LIBS, DATA, TILES].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// requête "cors" (réponse lisible, de taille réelle dans le quota) ; null si le serveur la refuse
async function corsFetch(url, ms) {
  const ctl = new AbortController(); const t = ms && setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl.signal }); return r.ok ? r : null; }
  catch (e) { return null; } finally { if (t) clearTimeout(t); }
}
async function cacheFirst(req, name, trim) {
  const c = await caches.open(name); const hit = await c.match(req.url);
  if (hit) return hit;
  const r = await corsFetch(req.url);
  if (r) { c.put(req.url, r.clone()); if (trim && Math.random() < 0.02) trimCache(c, 8000); return r; }
  return fetch(req);                      // repli : requête d'origine, sans mémorisation
}
async function trimCache(c, max) {
  const ks = await c.keys(); if (ks.length > max) await Promise.all(ks.slice(0, ks.length - max + 500).map(k => c.delete(k)));
}
async function dataNetworkFirst(req) {
  const c = await caches.open(DATA); const hit = await c.match(req.url);
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), hit ? 6000 : 90000);
    const r = await fetch(req.url, { signal: ctl.signal }); clearTimeout(t);
    if (r.ok) { c.put(req.url, r.clone()); return r; }
    if (hit) return hit; return r;
  } catch (e) { if (hit) return hit; throw e; }
}
async function appStaleWhileRevalidate(req) {
  const c = await caches.open(V);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  if (hit) { net.catch(() => {}); return hit; }
  return (await net) || new Response('Hors-ligne', { status: 503 });
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) return e.respondWith(appStaleWhileRevalidate(req));
  if (u.hostname === 'cdnjs.cloudflare.com') return e.respondWith(cacheFirst(req, LIBS));
  if (u.hostname === 'cadastre.data.gouv.fr') return e.respondWith(dataNetworkFirst(req));
  if (u.hostname === 'data.geopf.fr' || u.hostname === 'tile.openstreetmap.org') return e.respondWith(cacheFirst(req, TILES, true));
});
