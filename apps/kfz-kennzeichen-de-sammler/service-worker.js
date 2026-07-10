// KFZ-Kennzeichen Sammler – Service Worker
// Cacht die App-Hülle (HTML/CSS/JS/Karte), damit die App auch ohne
// Netz startet. Supabase-Daten (Auth, DB-Anfragen) laufen weiterhin
// über das Netzwerk bzw. werden von der Offline-Queue in index.html
// zwischengespeichert.

const CACHE_VERSION = 'kfz-sammler-v1';
const CACHE_NAME = CACHE_VERSION;

// Eigene Dateien (same-origin) – müssen bei jedem Deploy relativ zu
// diesem Ordner erreichbar sein.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './kreise.geojson',
  './icon-192.png',
  './icon-512.png'
];

// Externe Ressourcen (CDN). Werden "best effort" gecacht – schlägt das
// Cachen einer davon fehl, bricht die Installation trotzdem nicht ab.
const EXTERNAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Eigene Dateien: müssen klappen
      await cache.addAll(APP_SHELL);

      // Externe Dateien: einzeln versuchen, Fehler ignorieren
      await Promise.all(
        EXTERNAL_ASSETS.map((url) =>
          cache.add(new Request(url, { mode: 'no-cors' })).catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Strategie:
// - Navigationen (HTML-Aufrufe): Netzwerk zuerst, bei Fehler Cache (index.html)
// - Alles andere: Cache zuerst, bei Fehler Netzwerk (und dann nachträglich cachen)
// - Supabase-API-Aufrufe (*.supabase.co) werden NICHT abgefangen – die
//   müssen live gehen bzw. werden von der Offline-Queue in index.html behandelt.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Supabase-Requests (Auth + REST) immer direkt ans Netz durchlassen
  if (url.hostname.endsWith('supabase.co')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          // Nur erfolgreiche, same-origin oder opake Antworten cachen
          if (response && (response.ok || response.type === 'opaque')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
