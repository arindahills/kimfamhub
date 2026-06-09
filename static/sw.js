// v200 — React migration. Wipes ALL old caches (v1-v117 Jinja2 era).
const CACHE = "kimfamhub-v200";
const STATIC_ASSETS = ["/static/manifest.json", "/static/icon-192.png", "/static/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  // Delete every old cache (the v1-v117 Jinja2 era caches included)
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = e.request.url;

  // Never cache API or SSE streams
  if (url.includes("/api/") || url.includes("/assets/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Cache-first for static icons/manifest (long-lived, content-stable)
  if (url.includes("/static/")) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // Network-first for HTML shell — always get fresh React bundle references
  e.respondWith(
    fetch(e.request)
      .catch(() => caches.match(e.request))
  );
});
