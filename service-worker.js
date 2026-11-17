const CACHE_NAME = "booknest-shell-v10";
const APP_SHELL = [
  "./index.html",
  "./my-downloads.html",
  "./downloads.js",
  "./style.css",
  "./script.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./booknest-icon.svg",
  "./book.avif",
  "./book8.avif"
];
const CACHED_EXTERNAL_ASSETS = [
  "https://www.gstatic.com/firebasejs/13.3.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth-compat.js",
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.mjs",
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.mjs"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await Promise.all(CACHED_EXTERNAL_ASSETS.map((url) => cache.add(url).catch(() => null)));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("booknest-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;

  if (CACHED_EXTERNAL_ASSETS.includes(url.href)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => cache.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
      ))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && /\.(?:css|js|svg|png|avif|webp|jpg|jpeg|woff2?)$/i.test(url.pathname)) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => {
      if (request.mode === "navigate") return caches.match("./index.html");
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }))
  );
});
