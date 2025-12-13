const CACHE_NAME = "joint-notes-pwa-v2";
const ASSETS = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./Joint Notes logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const APP_SHELL_URL = new URL("./index.html", self.location).href;
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cached = await caches.match(APP_SHELL_URL);
      if (cached) return cached;
      try {
        const res = await fetch(APP_SHELL_URL);
        return res;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }
      const cached = await caches.match(req);
      return cached || (await caches.match(APP_SHELL_URL)) || res;
    } catch {
      const cached = await caches.match(req);
      return cached || (await caches.match(APP_SHELL_URL));
    }
  })());
});
