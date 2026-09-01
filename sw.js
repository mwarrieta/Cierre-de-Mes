/* Service worker · sirve la app sin señal.
   Los datos NO pasan por aquí: viven en IndexedDB (ver db.js).

   Estrategia: responde desde el caché al instante (la tablet abre aunque no
   haya señal) y en paralelo, si hay red, se trae la versión nueva y la guarda
   para el próximo arranque. Así una versión publicada llega sola a los
   dispositivos sin depender de que alguien se acuerde de subir el número de
   CACHE en cada despliegue. */
const CACHE = 'cierre-mes-v4';
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
  if (url.pathname.endsWith('/version.json')) return;   // siempre a la red
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(e.request);

    // Se pide la versión fresca aunque ya haya una guardada: si llega, queda
    // lista para el próximo arranque. Si no hay red, no pasa nada.
    const red = fetch(e.request).then(res => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);

    if (guardado) { e.waitUntil(red); return guardado; }
    return (await red) || (await cache.match('./index.html')) || Response.error();
  })());
});
