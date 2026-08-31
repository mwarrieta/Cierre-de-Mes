/* Service worker · sirve la app sin señal.
   Los datos NO pasan por aquí: viven en IndexedDB (ver db.js). */
const CACHE = 'cierre-mes-v2';
const ARCHIVOS = [
  './', './index.html', './styles.css', './config.js', './db.js', './app.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './supabase.js', './respaldo.js',
  './qr.js', './jsqr.js'   // jsqr solo lo usa iOS, pero cacheado sirve sin señal
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nunca cachear las llamadas a Supabase: siempre red, y si no hay red que falle
  // para que la app use su cola local.
  if (url.hostname.endsWith('.supabase.co')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin) {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
