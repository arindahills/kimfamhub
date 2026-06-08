const CACHE = "kimfamhub-v117";
const STATIC_ASSETS = ["/static/logo.png", "/static/manifest.json"];

// On install: cache only true static assets, skip the HTML
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// On activate: delete old caches immediately
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - API calls: always network, never cache
// - HTML (/ index): always network-first, fall back to cache only if offline
// - Static assets (logo, manifest): cache-first
self.addEventListener("fetch", e => {
  const url = e.request.url;

  if (url.includes("/api/")) return; // let API calls through unmodified

  if (url.includes("/static/")) {
    // Cache-first for logo and manifest
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // Network-first for everything else (the HTML page)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
