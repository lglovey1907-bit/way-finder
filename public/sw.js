// NDLS Wayfinder service worker: keeps the app and the last station data usable when the
// signal drops on platforms or under foot over bridges.
const V = 'wf-v52';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req, fallbackUrl) {
  const c = await caches.open(V);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(fallbackUrl || req, res.clone());
    return res;
  } catch (e) {
    const hit = await c.match(fallbackUrl || req);
    if (hit) return hit;
    throw e;
  }
}
async function cacheFirst(req) {
  const c = await caches.open(V);
  const hit = await c.match(req);
  const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname === '/api/data') return e.respondWith(networkFirst(req));
    if (url.pathname.startsWith('/api/file/')) return e.respondWith(cacheFirst(req));
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/staff')) return;
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, '/'));
    if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) return e.respondWith(cacheFirst(req));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || /\.blob\.vercel-storage\.com$/.test(url.hostname) || (/\.supabase\.co$/.test(url.hostname) && url.pathname.includes('/storage/v1/object/public/'))) {
    e.respondWith(cacheFirst(req));
  }
});
