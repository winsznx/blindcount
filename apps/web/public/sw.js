// BlindCount service worker. Caches the app shell and hashed static assets so the field form
// opens offline. API responses (which can carry manager-only data) are never cached.
const CACHE = "blindcount-shell-v2";
const SHELL = ["/app", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const remember = (request, response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return response;
};

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/health/") || url.pathname.startsWith("/invite/")) return;

  // Navigations: network first so a new deploy is always picked up; the cached shell is the offline fallback.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((res) => remember(e.request, res)).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/app"))));
    return;
  }
  // Content-hashed build assets never change under the same URL, so cache first is safe.
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => remember(e.request, res))));
  }
});
