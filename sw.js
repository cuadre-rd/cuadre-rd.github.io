// Sin internet: guarda la app en caché. build.ps1 cambia v30 en cada versión.
// Una versión nueva espera hasta que el usuario toca «Actualizar» (mensaje 'saltar'): así no se recarga a mitad de lo que anota.
const CACHE = 'wallet-v30';
const ARCHIVOS = ['./', 'index.html', 'estilos.css', 'textos.es.js', 'logica.js', 'prestamos.js', 'planes.js', 'consejos.js', 'factura.js', 'boveda.js', 'graficas.js', 'db.js', 'sistema.js', 'secciones.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'fuentes/CascadiaMono.ttf', 'config.js', 'portada.js', 'sincro.js', 'capturas/inicio.jpg', 'legal/privacidad.html', 'legal/terminos.html'];
// cache: 'reload' = pedir los archivos al servidor, no a la caché HTTP del navegador (GitHub Pages la guarda 10 min y la versión nueva traería archivos viejos)
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' }))))));
self.addEventListener('message', e => { if (e.data === 'saltar') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return; // Supabase y PayPal van directo a la red
  // Lo que no está en la lista (el lector de facturas de ocr/) se guarda la primera vez que se usa, para que luego funcione sin internet.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.status === 200 && !e.request.headers.has('range') && !/\/video\//.test(e.request.url) && new URL(e.request.url).origin === location.origin) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
    return res;
  })));
});
