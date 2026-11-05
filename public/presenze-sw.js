// Service worker delle sole pagine /timbra (cellulare del negozio) e /app
// (telefono del dipendente). Registrato con scope '/timbra' o '/app': non
// controlla il resto del gestionale, che resta sempre online come prima.
//
// Pagina: prima la rete (versione nuova), se non risponde entro 4 secondi
// la copia salvata. File /assets/ (nomi con hash, non cambiano mai): prima la
// copia salvata. Le chiamate a Supabase non passano da qui.
const CACHE = 'nz-presenze-v1';
const PAGINA = '/__pagina-presenze';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// La pagina manda l'elenco dei file che sta usando: li salviamo, cosi' al
// primo giro offline ci sono gia', e togliamo quelli delle versioni vecchie
// (il cellulare del negozio resta acceso per mesi: senza pulizia la memoria
// si riempirebbe a ogni pubblicazione).
self.addEventListener('message', (e) => {
  const urls = (e.data && e.data.tipo === 'salva' && Array.isArray(e.data.urls)) ? e.data.urls : [];
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    const inUso = new Set();
    for (const u of urls) {
      try {
        const p = new URL(u, self.location.origin);
        if (p.origin === self.location.origin && p.pathname.startsWith('/assets/')) inUso.add(p.pathname);
      } catch (_) { /* url non valido */ }
    }
    for (const u of urls) {
      try {
        const url = new URL(u, self.location.origin);
        if (url.origin !== self.location.origin || !url.pathname.startsWith('/assets/')) continue;
        if (await c.match(url.pathname)) continue;
        const r = await fetch(url.pathname);
        if (r.ok) await c.put(url.pathname, r);
      } catch (_) { /* si riprova al prossimo giro */ }
    }
    if (inUso.size > 0) {
      for (const req of await c.keys()) {
        const p = new URL(req.url).pathname;
        if (p.startsWith('/assets/') && !inUso.has(p)) await c.delete(req);
      }
    }
  }));
});

function conTempoMassimo(promessa, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tempo scaduto')), ms);
    promessa.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      conTempoMassimo(fetch(req), 4000)
        .then((r) => {
          if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(PAGINA, copia)); }
          return r;
        })
        .catch(() => caches.match(PAGINA).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg') {
    e.respondWith(
      caches.match(url.pathname).then((hit) => hit || fetch(req).then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copia)); }
        return r;
      })),
    );
  }
});
